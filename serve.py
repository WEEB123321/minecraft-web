#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方块世界 · 本地静态服务器
用法:
    python serve.py            # 监听 127.0.0.1:8765 并自动打开浏览器
    python serve.py 9000       # 指定端口
    python serve.py 9000 lan   # 监听 0.0.0.0（同一局域网的设备也能访问）
"""
import http.server
import socketserver
import sys
import os
import socket
import threading
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8765
LAN = len(sys.argv) > 2 and sys.argv[2].lower() == 'lan'
HOST = '0.0.0.0' if LAN else '127.0.0.1'

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.wasm': 'application/wasm',
        '.svg': 'image/svg+xml',
    })

    def end_headers(self):
        # 本地开发：不缓存，改了立刻生效
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静一点


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    with Server((HOST, PORT), Handler) as httpd:
        url = f'http://127.0.0.1:{PORT}/'
        print('=' * 56)
        print('  方块世界 · 网页版《我的世界》本地站已启动')
        print(f'  本机访问: {url}')
        if LAN:
            print(f'  局域网  : http://{lan_ip()}:{PORT}/  （手机/朋友可访问）')
        print('  按 Ctrl+C 退出')
        print('=' * 56)
        try:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已退出。')


if __name__ == '__main__':
    main()
