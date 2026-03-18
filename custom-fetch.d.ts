#!/usr/bin/env python3
"""
Jenny x Nadia — Local GPU Image Generation Server
Run this on your NVIDIA PC. It loads the AI model, opens a tunnel,
and prints the URL to paste into Replit as LOCAL_GPU_URL.

Requirements: pip install -r requirements.txt
"""

import base64
import io
import os
import sys
import time
import argparse
from typing import Optional, List

import torch
from PIL import Image
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ─── PARSE ARGS ──────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=7860, help="Local port (default 7860)")
parser.add_argument("--model", type=str, default="auto", help="Model: auto | sdxl-turbo | sdxl | sd15")
parser.add_argument("--no-tunnel", action="store_true", help="Skip ngrok tunnel (use if you handle tunneling yourself)")
parser.add_argument("--ngrok-token", type=str, default="", help="ngrok auth token (optional, free account works)")
args = parser.parse_args()

# ─── DETECT GPU ──────────────────────────────────────────────────────────────
if not torch.cuda.is_available():
    print("\n❌  No CUDA GPU detected. Make sure NVIDIA drivers + CUDA toolkit are installed.")
    sys.exit(1)

vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
gpu_name = torch.cuda.get_device_properties(0).name
print(f"\n✅  GPU: {gpu_name}  ({vram_gb:.1f} GB VRAM)")

# ─── PICK MODEL BASED ON VRAM ─────────────────────────────────────────────────
model_id = args.model
if model_id == "auto":
    if vram_gb >= 10:
        model_id = "sdxl-turbo"   # Best quality + fastest
        print("   Using: SDXL-Turbo (recommended for 10GB+ VRAM)")
    else:
        model_id = "sd15"
        print("   Using: SD 1.5 (lower VRAM mode)")

# ─── LOAD MODEL ──────────────────────────────────────────────────────────────
print(f"\n⏳  Loading model ({model_id})... first run downloads weights (~6GB), be patient\n")

pipe_txt2img = None
pipe_img2img = None

if model_id == "sdxl-turbo":
    from diffusers import AutoPipelineForText2Image, AutoPipelineForImage2Image
    pipe_txt2img = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo",
        torch_dtype=torch.float16,
        variant="fp16",
    ).to("cuda")
    pipe_img2img = AutoPipelineForImage2Image.from_pretrained(
        "stabilityai/sdxl-turbo",
        torch_dtype=torch.float16,
        variant="fp16",
        vae=pipe_txt2img.vae,
        text_encoder=pipe_txt2img.text_encoder,
        text_encoder_2=pipe_txt2img.text_encoder_2,
        tokenizer=pipe_txt2img.tokenizer,
        tokenizer_2=pipe_txt2img.tokenizer_2,
        unet=pipe_txt2img.unet,
        scheduler=pipe_txt2img.scheduler,
    ).to("cuda")

elif model_id == "sdxl":
    from diffusers import StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline
    pipe_txt2img = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
    ).to("cuda")
    pipe_img2img = StableDiffusionXLImg2ImgPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-refiner-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
    ).to("cuda")

else:  # sd15
    from diffusers import StableDiffusionPipeline, StableDiffusionImg2ImgPipeline
    pipe_txt2img = StableDiffusionPipeline.from_pretrained(
        "runwayml/stable-diffusion-v1-5",
        torch_dtype=torch.float16,
    ).to("cuda")
    pipe_img2img = StableDiffusionImg2ImgPipeline(
        vae=pipe_txt2img.vae,
        text_encoder=pipe_txt2img.text_encoder,
        tokenizer=pipe_txt2img.tokenizer,
        unet=pipe_txt2img.unet,
        scheduler=pipe_txt2img.scheduler,
        safety_checker=None,
        feature_extractor=None,
        requires_safety_checker=False,
    ).to("cuda")

print("✅  Model loaded!\n")

# ─── FASTAPI APP ─────────────────────────────────────────────────────────────
app = FastAPI(title="Jenny x Nadia GPU Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    steps: int = 8
    cfg_scale: float = 0.0   # ignored by turbo
    width: int = 512
    height: int = 768
    sampler_name: str = "default"

class Img2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    init_images: List[str] = []  # base64 raw strings
    denoising_strength: float = 0.4
    steps: int = 8
    cfg_scale: float = 0.0
    width: int = 512
    height: int = 768
    sampler_name: str = "default"

def pil_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def b64_to_pil(b64: str) -> Image.Image:
    # Strip data URI prefix if present
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")

@app.get("/")
def root():
    return {"status": "ok", "gpu": gpu_name, "model": model_id, "vram_gb": round(vram_gb, 1)}

@app.post("/sdapi/v1/txt2img")
def txt2img(req: Txt2ImgRequest):
    t = time.time()
    print(f"[txt2img] prompt: {req.prompt[:80]}…")

    kwargs = dict(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=req.width,
        height=req.height,
        num_inference_steps=req.steps,
    )
    if model_id == "sdxl-turbo":
        kwargs["guidance_scale"] = 0.0
        kwargs["num_inference_steps"] = 4
    else:
        kwargs["guidance_scale"] = req.cfg_scale if req.cfg_scale > 0 else 7.0

    result = pipe_txt2img(**kwargs)
    img = result.images[0]
    b64 = pil_to_b64(img)
    print(f"[txt2img] done in {time.time()-t:.1f}s")
    return {"images": [b64]}

@app.post("/sdapi/v1/img2img")
def img2img(req: Img2ImgRequest):
    t = time.time()
    print(f"[img2img] prompt: {req.prompt[:80]}… strength={req.denoising_strength}")

    if not req.init_images:
        return {"error": "No init_images provided"}, 400

    init_img = b64_to_pil(req.init_images[0])
    init_img = init_img.resize((req.width, req.height))

    kwargs = dict(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        image=init_img,
        strength=req.denoising_strength,
        num_inference_steps=req.steps,
    )
    if model_id == "sdxl-turbo":
        kwargs["guidance_scale"] = 0.0
        kwargs["num_inference_steps"] = 4
    else:
        kwargs["guidance_scale"] = req.cfg_scale if req.cfg_scale > 0 else 7.0

    result = pipe_img2img(**kwargs)
    img = result.images[0]
    b64 = pil_to_b64(img)
    print(f"[img2img] done in {time.time()-t:.1f}s")
    return {"images": [b64]}

# ─── NGROK TUNNEL ────────────────────────────────────────────────────────────
def start_tunnel(port: int, token: str = "") -> Optional[str]:
    try:
        from pyngrok import ngrok as ng, conf
        if token:
            conf.get_default().auth_token = token
        tunnel = ng.connect(port, "http")
        return tunnel.public_url
    except Exception as e:
        print(f"⚠️  ngrok tunnel failed: {e}")
        print("   Install ngrok separately or use --no-tunnel")
        return None

# ─── MAIN ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    public_url = None

    if not args.no_tunnel:
        print("🌐  Starting ngrok tunnel…")
        public_url = start_tunnel(args.port, args.ngrok_token)
        if public_url:
            print("\n" + "═" * 60)
            print("  ✅  TUNNEL READY")
            print(f"  Copy this URL → paste into Replit Secrets as LOCAL_GPU_URL:")
            print(f"\n      {public_url}\n")
            print("═" * 60 + "\n")
        else:
            print(f"   Server running locally on http://localhost:{args.port}")
    else:
        print(f"\n✅  Server starting on http://localhost:{args.port}")
        print("   (No tunnel — expose port yourself with ngrok or cloudflare)")

    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")
