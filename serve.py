#!/usr/bin/env python3
import http.server
import socketserver
import sys
import os
import base64
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8130
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, '__shots')
os.makedirs(SHOTS, exist_ok=True)


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path.startswith('/__shot'):
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', 'ignore')
            if ',' in body:
                body = body.split(',', 1)[1]
            name = self.path.split('/')[-1] or f'shot-{int(time.time())}'
            if name == '__shot':
                name = f'shot-{int(time.time() * 1000)}'
            try:
                with open(os.path.join(SHOTS, name + '.png'), 'wb') as f:
                    f.write(base64.b64decode(body))
                self.send_response(200)
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.write(b'ok')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


with socketserver.TCPServer(('127.0.0.1', PORT), NoCacheHandler) as httpd:
    print(f'THE LISTENING -> http://localhost:{PORT}')
    httpd.serve_forever()
