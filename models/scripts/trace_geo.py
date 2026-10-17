"""Blender の座標 ↔ 緯度経度（TRACE のチェックポイント用）

Blender の座標は PLATEAU と同じ平面直角座標系 第IX系（JGD2011, EPSG:6677）を
ずらしたもの（制作メモ.md「座標のルール」）:
    Blender x = 東向き（第IX系の Y）- (-3322)
    Blender y = 北向き（第IX系の X）- (-37645)
    Blender z = 地面からの高さ（地面 = 0）

緯度経度 ↔ 第IX系 は国土地理院の Gauss-Krüger の式（河瀬 2011）で計算する。
Blender の外でもそのまま動く（bpy を使わない）。
"""
import math

# GRS80
A = 6378137.0
F = 1 / 298.257222101
M0 = 0.9999
# 第IX系の原点
LAT0 = math.radians(36.0)
LON0 = math.radians(139 + 50 / 60)
# Blender の原点（第IX系の Y=東, X=北）
OFFSET_E = -3322.0
OFFSET_N = -37645.0

_n = F / (2 - F)
_A_ = A / (1 + _n) * (1 + _n**2 / 4 + _n**4 / 64)
_alpha = [
    _n / 2 - 2 * _n**2 / 3 + 5 * _n**3 / 16,
    13 * _n**2 / 48 - 3 * _n**3 / 5,
    61 * _n**3 / 240,
]
_beta = [
    _n / 2 - 2 * _n**2 / 3 + 37 * _n**3 / 96,
    _n**2 / 48 + _n**3 / 15,
    17 * _n**3 / 480,
]
_delta = [
    2 * _n - 2 * _n**2 / 3 - 2 * _n**3,
    7 * _n**2 / 3 - 8 * _n**3 / 5,
    56 * _n**3 / 15,
]
_e = 2 * math.sqrt(_n) / (1 + _n)


def _meridian(lat):
    """赤道から緯度 lat までの子午線の長さ（m0 を掛けた値）"""
    a = [
        -3 * _n / 2 + 9 * _n**3 / 16,
        15 * _n**2 / 16,
        -35 * _n**3 / 48,
    ]
    # 第3項まで（キャンパスの範囲ではミリ以下の差）
    s = _A_ * (lat + a[0] * math.sin(2 * lat) + a[1] * math.sin(4 * lat) + a[2] * math.sin(6 * lat))
    return M0 * s


_S0 = _meridian(LAT0)


def latlon_to_plane(lat_deg, lon_deg):
    """緯度経度 → 第IX系 (北 X, 東 Y)"""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    t = math.sinh(math.atanh(math.sin(lat)) - _e * math.atanh(_e * math.sin(lat)))
    tb = math.sqrt(1 + t * t)
    lc, ls = math.cos(lon - LON0), math.sin(lon - LON0)
    xi = math.atan2(t, lc)
    eta = math.atanh(ls / tb)
    x = xi + sum(_alpha[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    y = eta + sum(_alpha[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    return M0 * _A_ * x - _S0, M0 * _A_ * y


def plane_to_latlon(x, y):
    """第IX系 (北 X, 東 Y) → 緯度経度"""
    xi = (x + _S0) / (M0 * _A_)
    eta = y / (M0 * _A_)
    xi2 = xi - sum(_beta[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    eta2 = eta - sum(_beta[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    chi = math.asin(math.sin(xi2) / math.cosh(eta2))
    lat = chi + sum(_delta[j] * math.sin(2 * (j + 1) * chi) for j in range(3))
    lon = LON0 + math.atan2(math.sinh(eta2), math.cos(xi2))
    return math.degrees(lat), math.degrees(lon)


def blender_to_latlon(bx, by):
    return plane_to_latlon(by + OFFSET_N, bx + OFFSET_E)


def latlon_to_blender(lat_deg, lon_deg):
    x, y = latlon_to_plane(lat_deg, lon_deg)
    return y - OFFSET_E, x - OFFSET_N


# アプリの座標（TRACE_F src/lib/map/toyosu-campus.coordinates.json）
# ローカル ENU：原点 = 教室棟1F 南面の自動ドア、east / north はメートル
APP_COORDINATE_VERSION = "toyosu-2026-08-28.1"
APP_ORIGIN = (35.6607341, 139.7945576)
_R = 6378137.0


def latlon_to_enu(lat_deg, lon_deg):
    """coordinate-mapping.md の小範囲近似（アプリと同じ式）"""
    lat0, lon0 = APP_ORIGIN
    north = math.radians(lat_deg - lat0) * _R
    east = math.radians(lon_deg - lon0) * _R * math.cos(math.radians(lat0))
    return east, north


if __name__ == "__main__":
    lat, lon = APP_ORIGIN
    bx, by = latlon_to_blender(lat, lon)
    back = blender_to_latlon(bx, by)
    print("アプリの原点（自動ドア）の Blender 座標:", round(bx, 3), round(by, 3))
    print("往復の誤差 (m):", round((back[0] - lat) * 111000, 6), round((back[1] - lon) * 90000, 6))
