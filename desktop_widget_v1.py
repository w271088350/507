# -*- coding: utf-8 -*-
"""
桌面挂件（联网版）v1
内容：年月日 / 星期 / 时分秒 / 实时定位 / 当地天气
运行：python desktop_widget_v1.py   （仅用标准库，零第三方依赖）
操作：左键拖动移动位置；右键弹出菜单（刷新天气 / 退出）
"""

import json
import threading
import tkinter as tk
import urllib.request
from datetime import datetime

REFRESH_INTERVAL = 10 * 60 * 1000   # 天气刷新间隔：10 分钟
RETRY_INTERVAL = 60 * 1000          # 失败重试间隔：1 分钟

# ----------------------------- 天气图标映射 -----------------------------
def weather_icon(code: str) -> str:
    """按 wttr.in weatherCode 返回对应 emoji"""
    c = int(code)
    if c == 113:
        return "☀️"
    if c == 116:
        return "⛅"
    if c in (119, 122):
        return "☁️"
    if c in (143, 248, 260):
        return "🌫️"
    if c in (200, 386, 389, 392, 395):
        return "⛈️"
    if c in (179, 182, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350,
             362, 365, 368, 371, 374, 377):
        return "🌨️"
    return "🌧️"  # 其余均为各类降雨


# wttr.in 中文翻译不完整，本地翻译表兜底（键为小写英文描述）
WEATHER_ZH = {
    "sunny": "晴", "clear": "晴", "partly cloudy": "局部多云",
    "cloudy": "多云", "overcast": "阴", "mist": "薄雾", "fog": "雾",
    "freezing fog": "冻雾", "smoky haze": "霾", "haze": "霾", "smoke": "烟雾",
    "patchy rain possible": "局部有雨", "patchy light rain": "零星小雨",
    "light rain": "小雨", "light rain shower": "小阵雨",
    "moderate rain at times": "间歇性中雨", "moderate rain": "中雨",
    "heavy rain at times": "间歇性大雨", "heavy rain": "大雨",
    "moderate or heavy rain shower": "强阵雨", "torrential rain shower": "暴雨",
    "light drizzle": "毛毛雨", "patchy light drizzle": "零星毛毛雨",
    "freezing drizzle": "冻毛毛雨", "heavy freezing drizzle": "冻雨",
    "patchy snow possible": "局部有雪", "light snow": "小雪",
    "patchy moderate snow": "零星中雪", "moderate snow": "中雪",
    "patchy heavy snow": "零星大雪", "heavy snow": "大雪",
    "blizzard": "暴风雪", "blowing snow": "吹雪", "ice pellets": "冰粒",
    "light sleet": "雨夹雪", "moderate or heavy sleet": "强雨夹雪",
    "light snow showers": "小阵雪", "moderate or heavy snow showers": "强阵雪",
    "thundery outbreaks possible": "局部雷暴",
    "patchy light rain with thunder": "雷阵雨",
    "moderate or heavy rain with thunder": "强雷雨",
    "patchy light snow with thunder": "雷阵雪",
    "moderate or heavy snow with thunder": "强雷雪",
}


def translate_desc(desc: str) -> str:
    return WEATHER_ZH.get(desc.strip().lower(), desc.strip())


# ----------------------------- 网络请求 -----------------------------
def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "desktop-widget/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_location() -> dict:
    """通过 IP 定位，返回 {city, lat, lon}"""
    data = http_get_json(
        "http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon&lang=zh-CN"
    )
    if data.get("status") != "success":
        raise RuntimeError("定位失败")
    return data


def fetch_weather(lat: float, lon: float) -> dict:
    """按经纬度获取当地实时天气"""
    data = http_get_json(f"https://wttr.in/{lat},{lon}?format=j1&lang=zh")
    cur = data["current_condition"][0]
    desc = translate_desc(cur["weatherDesc"][0]["value"])
    return {
        "icon": weather_icon(cur["weatherCode"]),
        "desc": desc,
        "temp": cur["temp_C"],
        "feels": cur["FeelsLikeC"],
        "humidity": cur["humidity"],
        "wind_speed": cur["windspeedKmph"],
    }


# ----------------------------- 主窗口 -----------------------------
class DesktopWidget(tk.Tk):
    BG = "#16161f"       # 深色玻璃底色
    FG = "#f2f2f7"
    SUB = "#9d9db5"
    ACCENT = "#7dd3fc"

    def __init__(self):
        super().__init__()
        self.title("桌面挂件")
        self.overrideredirect(True)          # 无边框
        self.attributes("-topmost", True)    # 置顶
        self.attributes("-alpha", 0.92)      # 半透明
        self.configure(bg=self.BG)

        self._build_ui()
        self._build_menu()
        self._bind_drag()
        self._place_top_right()

        self.location = None                 # 定位缓存
        self._tick()                         # 启动时钟
        self._refresh_weather()              # 启动天气

    # ---------- UI ----------
    def _build_ui(self):
        card = tk.Frame(self, bg=self.BG, padx=18, pady=14)
        card.pack()

        # 第一行：定位 + 天气概况
        top = tk.Frame(card, bg=self.BG)
        top.pack(fill="x")
        self.lbl_loc = tk.Label(top, text="📍 定位中…", bg=self.BG,
                                fg=self.ACCENT, font=("Microsoft YaHei UI", 10))
        self.lbl_loc.pack(side="left")
        self.lbl_weather = tk.Label(top, text="", bg=self.BG, fg=self.FG,
                                    font=("Microsoft YaHei UI", 11, "bold"))
        self.lbl_weather.pack(side="right")

        # 第二行：大号时间
        self.lbl_time = tk.Label(card, text="--:--:--", bg=self.BG, fg=self.FG,
                                 font=("Segoe UI", 34, "bold"))
        self.lbl_time.pack(pady=(6, 0))

        # 第三行：日期 + 星期
        self.lbl_date = tk.Label(card, text="", bg=self.BG, fg=self.SUB,
                                 font=("Microsoft YaHei UI", 11))
        self.lbl_date.pack()

        # 第四行：天气详情
        self.lbl_detail = tk.Label(card, text="", bg=self.BG, fg=self.SUB,
                                   font=("Microsoft YaHei UI", 9))
        self.lbl_detail.pack(pady=(8, 0))

    def _build_menu(self):
        menu = tk.Menu(self, tearoff=0, bg="#23232f", fg=self.FG,
                       activebackground=self.ACCENT, activeforeground="#16161f")
        menu.add_command(label="🔄 刷新天气", command=self._refresh_weather)
        menu.add_separator()
        menu.add_command(label="❌ 退出", command=self.destroy)
        self.bind("<Button-3>", lambda e: menu.tk_popup(e.x_root, e.y_root))

    # ---------- 拖动 ----------
    def _bind_drag(self):
        def start(e):
            self._dx, self._dy = e.x, e.y

        def move(e):
            self.geometry(f"+{e.x_root - self._dx}+{e.y_root - self._dy}")

        self.bind("<Button-1>", start)
        self.bind("<B1-Motion>", move)

    def _place_top_right(self):
        self.update_idletasks()
        w, h = self.winfo_reqwidth(), self.winfo_reqheight()
        x = self.winfo_screenwidth() - w - 30
        self.geometry(f"+{x}+30")

    # ---------- 时钟 ----------
    def _tick(self):
        now = datetime.now()
        self.lbl_time.config(text=now.strftime("%H:%M:%S"))
        weeks = "一二三四五六日"
        self.lbl_date.config(
            text=now.strftime(f"%Y年%m月%d日  星期{weeks[now.weekday()]}")
        )
        self.after(500, self._tick)

    # ---------- 天气 ----------
    def _refresh_weather(self):
        self.lbl_detail.config(text="天气更新中…")
        threading.Thread(target=self._weather_worker, daemon=True).start()

    def _weather_worker(self):
        try:
            if not self.location:
                self.location = fetch_location()
            w = fetch_weather(self.location["lat"], self.location["lon"])
            self.after(0, lambda: self._show_weather(self.location, w))
            self.after(REFRESH_INTERVAL, self._refresh_weather)
        except Exception:
            self.after(0, lambda: self.lbl_detail.config(
                text="⚠️ 天气获取失败，1 分钟后重试"))
            self.after(RETRY_INTERVAL, self._refresh_weather)

    def _show_weather(self, loc: dict, w: dict):
        city = loc.get("city") or loc.get("regionName") or "未知地区"
        self.lbl_loc.config(text=f"📍 {city}")
        self.lbl_weather.config(text=f"{w['icon']} {w['temp']}°C")
        self.lbl_detail.config(
            text=f"{w['desc']}  体感 {w['feels']}°C  "
                 f"湿度 {w['humidity']}%  风 {w['wind_speed']}km/h"
        )


if __name__ == "__main__":
    DesktopWidget().mainloop()
