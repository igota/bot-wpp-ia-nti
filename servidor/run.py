import os
import sys
import time
from waitress import serve
from app import app
from dotenv import load_dotenv

# Carrega variáveis do .env
load_dotenv()

# Configurações do .env
PORT = int(os.getenv('PORT', 5000))
HOST = os.getenv('HOST', '0.0.0.0')
BASE_URL = os.getenv('BASE_URL', 'http://localhost:5000')
ENV = os.getenv('ENV', 'production')

def run_server():
    """Função para rodar o servidor"""
    serve(app, host=HOST, port=PORT, threads=4)

if __name__ == "__main__":
    print("=" * 60)
    print(f"[START] Iniciando servidor de reset de senha")
    print(f"[INFO] Ambiente: {ENV}")
    print(f"[INFO] Host: {HOST}:{PORT}")
    print(f"[INFO] URL: {BASE_URL}")
    print("=" * 60)
    print("[OK] Servidor rodando")
    print("=" * 60)
    
    try:
        run_server()
    except KeyboardInterrupt:
        print("\n[STOP] Servidor interrompido")
    except Exception as e:
        print(f"[ERROR] Erro no servidor: {e}")
        # Mantém o processo vivo mesmo com erro
        while True:
            time.sleep(60)