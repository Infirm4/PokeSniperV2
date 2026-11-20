"""Controle local de Auto-Catch no PokeIdle.io.

O Python envia um pulso periodico a uma extensao do Chrome via WebSocket.
A extensao executa apenas cliques de botoes da interface de captura, na aba
existente do jogo, sem mover o cursor e sem abrir um browser automatizado.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import websockets
from websockets.exceptions import ConnectionClosed

BASE = Path(__file__).resolve().parent
CONFIG_PATH = BASE / "config.json"
STOP_PATH = BASE / "parar.flag"
LOG_PATH = BASE / "bot.log"
HOST = "127.0.0.1"
PORT = 8765


def config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        cfg = json.load(handle)
    seconds = float(cfg.get("intervalo_segundos", 3.0))
    if not 2 <= seconds <= 3600:
        raise ValueError("O intervalo deve estar entre 2 e 3600 segundos.")
    return {"intervalo_segundos": seconds}


class Bot:
    def __init__(self, seconds: float):
        self.interval = seconds
        self.client = None
        self.last_state = None
        self.total_clicks = 0
        self.last_report = 0.0
        self.last_tick = 0.0
        self.pending_request = None

    async def receive(self, socket):
        origin = socket.request.headers.get("Origin", "")
        if not origin.startswith("chrome-extension://"):
            await socket.close(code=1008, reason="Apenas a extensao local pode conectar.")
            logging.warning("Conexao rejeitada: origem nao e extensao Chrome.")
            return
        if self.client is not None and self.client is not socket:
            await socket.close(code=1008, reason="Ja existe uma extensao conectada.")
            logging.warning("Segunda extensao rejeitada. Deixe apenas uma conexao ativa.")
            return

        self.client = socket
        self.last_state = None
        logging.info("Extensao conectada. Abra a hunt em pokeidle.io e pode minimizar a janela.")
        try:
            async for raw in socket:
                try:
                    data = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                kind = data.get("type")
                if kind == "result":
                    self.pending_request = None
                    status = str(data.get("status", "desconhecido"))
                    count = max(0, min(int(data.get("clicks", 0)), 100))
                    if count:
                        self.total_clicks += count
                        logging.info("%s clique(s) de captura solicitado(s) | total=%s (nao confirma captura)", count, self.total_clicks)
                        self.last_state = None
                    else:
                        now = time.monotonic()
                        if status != self.last_state or now - self.last_report > 60:
                            messages = {
                                "sem_aba": "Nenhuma aba de pokeidle.io encontrada no Chrome.",
                                "descartada": "A aba foi descarregada pelo Chrome. Reabra o jogo.",
                                "aguardando": "Aguardando Pokemon caidos na hunt.",
                                "sem_lista": "Lista de Pokemon caidos ainda nao apareceu. Entre numa hunt.",
                                "cooldown": "Pokemon caidos encontrados; aguardando intervalo para nao repetir o clique.",
                                "sem_permissao": "Sem permissao para clicar na pagina. Confira a extensao.",
                                "erro": "Falha no comando da extensao. Confira logs / pagina.",
                            }
                            logging.info(messages.get(status, "Estado da extensao: %s"), *(() if status in messages else (status,)))
                            self.last_state, self.last_report = status, now
                elif kind == "hello":
                    logging.info("Extensao pronta para receber comandos.")
                elif kind == "ping":
                    pass
        except ConnectionClosed:
            pass
        finally:
            if self.client is socket:
                self.client = None
                self.pending_request = None
                logging.warning("Extensao desconectada. Aguardando reconexao automaticamente.")

    async def cycle(self):
        waiting_logged = False
        while not STOP_PATH.exists():
            client = self.client
            if client is None:
                if not waiting_logged:
                    logging.info("Aguardando conexao da extensao. Pode levar ate 30 segundos; abra o popup e clique Conectar agora para acelerar.")
                    waiting_logged = True
            else:
                waiting_logged = False
                now = time.monotonic()
                if self.pending_request is not None and now - self.pending_request > 15:
                    logging.warning("Chrome nao respondeu ao ultimo comando. Verifique se nao esta suspenso.")
                    self.pending_request = None
                if self.pending_request is None:
                    try:
                        await client.send(json.dumps({"type": "throw"}))
                        self.pending_request = time.monotonic()
                    except ConnectionClosed:
                        pass
            await asyncio.sleep(self.interval)
        logging.info("Parada solicitada. Total de cliques enviados: %s", self.total_clicks)
        if self.client is not None:
            await self.client.close(code=1000, reason="Bot encerrado")


async def main():
    if STOP_PATH.exists():
        STOP_PATH.unlink()
    cfg = config()
    logging.info("Bot local iniciado em ws://%s:%d", HOST, PORT)
    logging.info("Intervalo entre comandos: %.1f segundos. Nenhum movimento de mouse.", cfg["intervalo_segundos"])
    logging.info("Para parar: execute parar_bot.bat. Nao feche o Chrome.")
    bot = Bot(cfg["intervalo_segundos"])
    async with websockets.serve(bot.receive, HOST, PORT, max_size=8192, ping_interval=20, ping_timeout=30):
        await bot.cycle()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s | %(message)s", datefmt="%H:%M:%S",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(LOG_PATH, encoding="utf-8")])
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        logging.info("Bot interrompido manualmente.")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logging.error("Erro: %s", exc)
        logging.error("Se a porta %d estiver ocupada, feche outra instancia do bot.", PORT)
        raise SystemExit(1)
