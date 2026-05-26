#!/usr/bin/env python3
"""Generate voiceover audio for each tutorial scene using Edge TTS."""
import asyncio
import edge_tts
import os
import json

VOICE = "zh-TW-HsiaoYuNeural"
RATE = "+5%"  # Slightly faster for tutorial pacing
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "voiceover")

SCENES = [
    {"id": "00-title", "text": "嗨！我是小美，今天帶你快速上手商品企劃畫布。"},
    {"id": "01-hub", "text": "這是摩托麻吉的內容策略工具入口。今天帶你走一遍商品企劃畫布的完整流程。"},
    {"id": "02-material", "text": "進入商品企劃後，這是素材準備視圖。左邊長片、右邊短片，一目了然。"},
    {"id": "03-modal-empty", "text": "點加號新增一個影片企劃節點。填入主題、選內容目的、寫CTA。"},
    {"id": "04-modal-filled", "text": "填好資料，按建立。Job選培育代表這支影片的目的是加深觀眾信任。"},
    {"id": "05-panel", "text": "點選任何節點，右側面板會展開節點的完整詳情。"},
    {"id": "06-research", "text": "按AI研究，系統會自動分析產品定位、競品狀況、觀眾在意什麼。"},
    {"id": "07-angles", "text": "AI還會建議拍攝角度。覺得好就按採用，直接加進企劃裡。"},
    {"id": "08-brief", "text": "切到Brief分頁，把草稿想法填進去，按AI潤稿，就能產出正式拍攝Brief。"},
    {"id": "09-journey", "text": "切換到購買階段視圖，看每個影片落在哪個階段。一眼抓出策略缺口。"},
    {"id": "10-connections", "text": "覺得兩支影片有關聯？拉連線串起來，規劃系列感。"},
    {"id": "11-review", "text": "節點夠多後，按AI檢討。它會給你策略評分和具體改善建議。"},
    {"id": "12-review-detail", "text": "每個建議都標註嚴重度，告訴你哪些問題最該先處理。"},
    {"id": "13-ending", "text": "就是這樣！從空白到完整的內容策略，全部在一個畫布上搞定。"},
]

async def generate_one(scene):
    output_path = os.path.join(OUTPUT_DIR, f"{scene['id']}.mp3")
    communicate = edge_tts.Communicate(scene["text"], VOICE, rate=RATE)
    await communicate.save(output_path)
    print(f"  -> {scene['id']}.mp3")

async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Generating {len(SCENES)} voiceover files with {VOICE}...\n")

    for scene in SCENES:
        await generate_one(scene)

    print(f"\nDone! Files saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    asyncio.run(main())
