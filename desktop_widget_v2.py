# -*- coding: utf-8 -*-
"""
桌面挂件（联网版）v2
内容：年月日 / 星期 / 时分秒 / 农历（干支生肖+传统节日）/ 实时定位 / 当地天气
运行：python desktop_widget_v2.py   （仅用标准库，零第三方依赖）
操作：左键拖动移动位置；右键弹出菜单（刷新天气 / 退出）
v2 变更：新增农历显示（纯算法实现，1900-2100 有效）
"""

import json
import threading
import tkinter as tk
import urllib.request
from datetime import date, datetime

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


# ----------------------------- 农历计算（1900-2100） -----------------------------
# 每年一个十六进制数：bit16-1 表示 1-12 月大小（1 大 30 天 / 0 小 29 天），
# bit20-17 表示闰月天数，低 4 位表示闰几月（0 为无闰月）
LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0,
    0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
    0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50,
    0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
    0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
    0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573,
    0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
    0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5,
    0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46,
    0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
    0x055c0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50,
    0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
    0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
    0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0,
    0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
    0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370,
    0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0,
    0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50,
    0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930, 0x07337, 0x06aa0,
    0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968, 0x0d520,
    0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520,
]

LUNAR_MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月",
                "七月", "八月", "九月", "十月", "冬月", "腊月"]
GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"
ZODIAC = "鼠牛虎兔龙蛇马羊猴鸡狗猪"
# 农历传统节日：(月, 日) -> 节日名
LUNAR_FESTIVALS = {
    (1, 1): "春节", (1, 15): "元宵节", (2, 2): "龙抬头",
    (5, 5): "端午节", (7, 7): "七夕", (7, 15): "中元节",
    (8, 15): "中秋节", (9, 9): "重阳节", (12, 8): "腊八节",
    (12, 23): "小年",
}


def _leap_month(y: int) -> int:
    return LUNAR_INFO[y - 1900] & 0xF


def _leap_days(y: int) -> int:
    if not _leap_month(y):
        return 0
    return 30 if (LUNAR_INFO[y - 1900] & 0x10000) else 29


def _month_days(y: int, m: int) -> int:
    return 30 if (LUNAR_INFO[y - 1900] & (0x10000 >> m)) else 29


def _lunar_day_name(d: int) -> str:
    n1, n2 = "日一二三四五六七八九", ("初", "十", "廿", "卅")
    if d == 10:
        return "初十"
    if d == 20:
        return "二十"
    if d == 30:
        return "三十"
    return n2[(d - 1) // 10] + n1[d % 10]


def lunar_date(d: date) -> dict:
    """公历日期 -> 农历 {year, month, day, is_leap}"""
    if not (date(1900, 1, 31) <= d <= date(2100, 12, 31)):
        raise ValueError("仅支持 1900-2100 年")
    offset = (d - date(1900, 1, 31)).days  # 1900-01-31 为农历1900年正月初一

    year = 1900
    while year < 2101:
        days_of_year = (sum(_month_days(year, m) for m in range(1, 13))
                        + _leap_days(year))
        if offset < days_of_year:
            break
        offset -= days_of_year
        year += 1

    leap = _leap_month(year)
    month, is_leap = 1, False
    while month <= 12:
        span = _month_days(year, month)
        if leap == month:  # 当年闰月排在该月之后
            span_leap = _leap_days(year)
            if offset < span:
                is_leap = False
                break
            if offset < span + span_leap:
                offset -= span
                is_leap = True
                break
            offset -= span + span_leap
            month += 1
            continue
        if offset < span:
            break
        offset -= span
        month += 1

    return {"year": year, "month": month, "day": offset + 1, "is_leap": is_leap}


def lunar_text(d: date) -> str:
    """生成展示文本：丙午年【马】 农历七月初八·中元节"""
    try:
        ld = lunar_date(d)
    except ValueError:
        return ""
    gz = GAN[(ld["year"] - 4) % 10] + ZHI[(ld["year"] - 4) % 12]
    zodiac = ZODIAC[(ld["year"] - 4) % 12]
    month = ("闰" if ld["is_leap"] else "") + LUNAR_MONTHS[ld["month"] - 1]
    text = f"{gz}年【{zodiac}】  农历{month}{_lunar_day_name(ld['day'])}"
    festival = LUNAR_FESTIVALS.get((ld["month"], ld["day"]))
    if festival and not ld["is_leap"]:
        text += f" · {festival}"
    return text


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

        # 第四行：农历（干支生肖 + 农历月日 + 节日）
        self.lbl_lunar = tk.Label(card, text="", bg=self.BG, fg="#e8c07d",
                                  font=("Microsoft YaHei UI", 10))
        self.lbl_lunar.pack(pady=(2, 0))

        # 第五行：天气详情
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
        self.lbl_lunar.config(text=lunar_text(now.date()))
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
