"""황량계 로컬 개발 서버 — 캐시를 끄고 http://localhost:8080 에서 이 폴더를 띄웁니다.
CSS·JS 를 고친 뒤 새로고침만 하면 바로 반영됩니다. (serve.bat 이 이 파일을 실행합니다)"""
import http.server, os, socketserver

PORT = 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

print(f"  Serving {os.getcwd()} at http://localhost:{PORT}  (Ctrl+C or close window to stop)")
Server(("", PORT), NoCacheHandler).serve_forever()
