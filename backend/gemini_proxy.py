import asyncio
import os
import json
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash-exp"
GEMINI_WS_URL = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={GEMINI_API_KEY}"


@app.get("/health")
async def health():
    return {"status": "ok", "gemini_key_set": bool(GEMINI_API_KEY)}


@app.websocket("/ws/gemini")
async def gemini_proxy(client_ws: WebSocket):
    await client_ws.accept()
    
    if not GEMINI_API_KEY:
        await client_ws.send_text(json.dumps({"error": "GEMINI_API_KEY not configured"}))
        await client_ws.close()
        return

    try:
        async with websockets.connect(GEMINI_WS_URL) as gemini_ws:

            async def forward_to_gemini():
                try:
                    while True:
                        data = await client_ws.receive_text()
                        await gemini_ws.send(data)
                except (WebSocketDisconnect, Exception):
                    await gemini_ws.close()

            async def forward_to_client():
                try:
                    async for message in gemini_ws:
                        if isinstance(message, bytes):
                            await client_ws.send_bytes(message)
                        else:
                            await client_ws.send_text(message)
                except (WebSocketDisconnect, Exception):
                    pass

            await asyncio.gather(
                forward_to_gemini(),
                forward_to_client(),
                return_exceptions=True
            )
    except Exception as e:
        try:
            await client_ws.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
