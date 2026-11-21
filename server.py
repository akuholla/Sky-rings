#!/usr/bin/env python3
"""Sky Rings local server (Python standard library only).

- http://localhost:8137          the game (this computer only)
- https://<lan-ip>:8443          the phone controller page (local network). Phones only
                                 expose motion sensors to secure pages, so this uses a
                                 self-signed certificate generated on first run with openssl.
- /api/events?s=CODE  (GET, SSE) the game listens here for controller messages
- /api/input?s=CODE   (POST)     the phone sends tilt / fire messages here
- /api/info                      LAN address + ports, used to build the pairing link

Only the game's own files are served (index.html, controller.html, style.css, js/*).
"""
import http.server
import json
import os
import queue
import socket
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
HTTP_PORT = int(os.environ.get('HTTP_PORT', 8137))
HTTPS_PORT = int(os.environ.get('HTTPS_PORT', 8443))
CERT_DIR = os.path.join(ROOT, '.certs')
ALLOWED_FILES = {'/index.html', '/controller.html', '/style.css', '/controller.css', '/controller.webmanifest', '/icon.svg'}

sessions = {}            # code -> list of listener queues
sessions_lock = threading.Lock()


def lan_ip():
    """Best-effort local network address (no packets are sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def ensure_cert(ip):
    os.makedirs(CERT_DIR, exist_ok=True)
    cert, key, stamp = (os.path.join(CERT_DIR, n) for n in ('cert.pem', 'key.pem', 'ip.txt'))
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp) and open(stamp).read() == ip:
        return cert, key
    print(f'Generating a self-signed certificate for {ip} ...')
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', cert, '-days', '825', '-subj', '/CN=Sky Rings local',
        '-addext', f'subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost',
    ], check=True, capture_output=True)
    with open(stamp, 'w') as f:
        f.write(ip)
    return cert, key


def valid_code(code):
    return code.isalnum() and 3 <= len(code) <= 12


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.js': 'text/javascript'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if args and '/api/input' in str(args[0]):
            return  # too chatty (30 per second)
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _code(self, url):
        code = (parse_qs(url.query).get('s') or [''])[0].upper()
        return code if valid_code(code) else None

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/info':
            return self._json({'lanIp': lan_ip(), 'httpsPort': HTTPS_PORT, 'httpPort': HTTP_PORT})
        if url.path == '/api/events':
            return self._events(url)
        if url.path == '/api/status':
            code = self._code(url)
            with sessions_lock:
                return self._json({'game': bool(code and sessions.get(code))})
        path = '/index.html' if url.path == '/' else url.path
        if path in ALLOWED_FILES or (path.startswith('/js/') and path.endswith('.js') and '..' not in path):
            return super().do_GET()
        self.send_error(404)

    def _events(self, url):
        code = self._code(url)
        if not code:
            return self._json({'error': 'bad code'}, 400)
        q = queue.Queue(maxsize=8)
        with sessions_lock:
            sessions.setdefault(code, []).append(q)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(b'retry: 2000\n\n')
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(b'data: ' + msg + b'\n\n')
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError, OSError):
            pass
        finally:
            with sessions_lock:
                lst = sessions.get(code, [])
                if q in lst:
                    lst.remove(q)
                if not lst:
                    sessions.pop(code, None)

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        url = urlparse(self.path)
        if url.path != '/api/input':
            return self.send_error(404)
        code = self._code(url)
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(min(length, 2048))
        if not code:
            return self._json({'error': 'bad code'}, 400)
        try:
            json.loads(body)  # only relay well-formed JSON
        except ValueError:
            return self._json({'error': 'bad json'}, 400)
        with sessions_lock:
            listeners = list(sessions.get(code, []))
        for q in listeners:
            if q.full():  # keep only the freshest messages
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
            try:
                q.put_nowait(body)
            except queue.Full:
                pass
        self._json({'game': bool(listeners)})


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ip = lan_ip()
    http_srv = Server(('127.0.0.1', HTTP_PORT), Handler)
    threading.Thread(target=http_srv.serve_forever, daemon=True).start()
    print(f'Game:              http://localhost:{HTTP_PORT}')
    try:
        cert, key = ensure_cert(ip)
        https_srv = Server(('0.0.0.0', HTTPS_PORT), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        https_srv.socket = ctx.wrap_socket(https_srv.socket, server_side=True)
        threading.Thread(target=https_srv.serve_forever, daemon=True).start()
        print(f'Phone controller:  https://{ip}:{HTTPS_PORT}/controller.html  (same Wi-Fi)')
    except Exception as e:  # game still works without the phone controller
        print('Phone controller unavailable (HTTPS setup failed):', e, file=sys.stderr)
    sys.stdout.flush()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
