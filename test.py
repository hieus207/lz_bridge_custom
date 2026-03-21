import hashlib
import hmac
import base64
import time
import uuid
import random
import requests
from urllib.parse import urlparse


# ─────────────────────────────────────────────────────────────────────────────
# X-Apikey generator  (reverse-engineered từ module 57816 trong check.js)
# ─────────────────────────────────────────────────────────────────────────────
class ApiKeyGenerator:
    """
    Logic gốc từ JS:

    API_KEY  = "a2c903cc-b31e-4547-9299-b6d07b7631ab"
    SALT     = 1111111111111

    encryptApiKey():
        chars = list(API_KEY)
        head  = chars[:8]          # lấy 8 ký tự đầu
        return ''.join(chars[8:] + head)   # ghép phần còn lại + 8 ký tự đầu
        # → "-b31e-4547-9299-b6d07b7631aba2c903cc"

    encryptTime(ts_ms):
        t = list(str(ts_ms + SALT))
        append 3 random digits (0-9)
        return ''.join(t)

    comb(encrypted_key, encrypted_time):
        return base64( encrypted_key + "|" + encrypted_time )

    getApiKey():
        ts = Date.now()
        return comb( encryptApiKey(), encryptTime(ts) )
    """

    API_KEY = "a2c903cc-b31e-4547-9299-b6d07b7631ab"
    SALT    = 1111111111111

    @staticmethod
    def encrypt_api_key() -> str:
        chars = list(ApiKeyGenerator.API_KEY)
        head  = chars[:8]
        return "".join(chars[8:] + head)   # "-b31e-4547-9299-b6d07b7631aba2c903cc"

    @staticmethod
    def encrypt_time(ts_ms: int) -> str:
        digits = list(str(ts_ms + ApiKeyGenerator.SALT))
        noise  = [str(random.randint(0, 9)) for _ in range(3)]
        return "".join(digits + noise)

    @classmethod
    def get_api_key(cls, ts_ms: int | None = None) -> str:
        if ts_ms is None:
            ts_ms = int(time.time() * 1000)
        encrypted_key  = cls.encrypt_api_key()
        encrypted_time = cls.encrypt_time(ts_ms)
        combined = f"{encrypted_key}|{encrypted_time}"
        return base64.b64encode(combined.encode()).decode()


# ─────────────────────────────────────────────────────────────────────────────
# Ok-Verify-Sign signer  (logic từ file Python gốc)
# ─────────────────────────────────────────────────────────────────────────────
class OKLinkSigner:
    def __init__(self, device_id: str | None = None):
        self.device_id = device_id or str(uuid.uuid4())
        self.token:     str | None = None
        self.timestamp: int | None = None

    # ── internal helpers ──────────────────────────────────────────────────────

    def _generate_uuid(self) -> str:
        return str(uuid.uuid4())

    def _hash_token(self, token: str) -> bytes:
        return hashlib.sha256(token.encode()).digest()

    def _shuffle_hash(self, hash_bytes: bytes, timestamp_sec: int) -> str:
        hash_array = list(hash_bytes)
        f = (timestamp_sec // 600)  % 32
        p = (timestamp_sec // 3600) % 32
        result = []
        for d in range(32):
            idx = (f + (p + d) * d) % 32
            result.append(hash_array[idx])
        return "".join(format(b, "02x") for b in result)

    def _create_sign_content(self, url: str, method: str = "GET", body=None) -> str:
        parsed = urlparse(url)
        path   = parsed.path
        query  = parsed.query

        if method.upper() == "GET":
            return f"{path}?{query}" if query else path
        else:
            content = path
            if body:
                import json
                content += json.dumps(body, separators=(",", ":")) if isinstance(body, dict) else str(body)
            content += str(self.timestamp)
            return content

    def _sign_content(self, content: str, key_hex: str) -> str:
        key_bytes = bytes.fromhex(key_hex)
        sig = hmac.new(key_bytes, content.encode("utf-8"), hashlib.sha256).digest()
        return base64.b64encode(sig).decode()

    def _generate_key_and_sign(self, url: str, method: str = "GET", body=None,
                                timestamp_ms: int | None = None):
        self.token     = self._generate_uuid()
        self.timestamp = timestamp_ms or int(time.time() * 1000)

        token_hash    = self._hash_token(self.token)
        timestamp_sec = self.timestamp // 1000
        key           = self._shuffle_hash(token_hash, timestamp_sec)

        content   = self._create_sign_content(url, method, body)
        signature = self._sign_content(content, key)
        return signature, content

    # ── public header builders ────────────────────────────────────────────────

    def get_headers(self, url: str, method: str = "GET", body=None,
                    timestamp_ms: int | None = None,
                    referer: str = "https://www.oklink.com/",
                    locale: str = "en_US",
                    utc_offset: int = 7,
                    site_info: str = "9FjOikHdpRnblJCLiskTJx0SPJiOiUGZvNmIsIiTWJiOi42bpdWZyJye",
                    cdn: str = "https://static.oklink.com") -> dict:
        """
        Trả về headers đầy đủ khớp với request thực từ browser, gồm:
          - Ok-Verify-Token / Ok-Timestamp / Ok-Verify-Sign  (auth signature)
          - X-Apikey                                          (base64 token từ module 57816)
          - X-Cdn / X-Locale / X-Utc / X-Site-Info / X-Zkdex-Env / X-Simulated-Trading
          - Devid + các browser headers chuẩn
        """
        signature, _ = self._generate_key_and_sign(url, method, body, timestamp_ms)

        # X-Apikey dùng cùng timestamp với signature để nhất quán
        x_api_key = ApiKeyGenerator.get_api_key(self.timestamp)

        headers = {
            # ── Verify signature ──────────────────────────────────────────
            "Ok-Verify-Token":      self.token,
            "Ok-Timestamp":         str(self.timestamp),
            "Ok-Verify-Sign":       signature,

            # ── API key (module 57816) ─────────────────────────────────────
            "X-Apikey":             x_api_key,

            # ── X-* headers từ browser ────────────────────────────────────
            "X-Cdn":                cdn,
            "X-Locale":             locale,
            "X-Utc":                str(utc_offset),
            "X-Site-Info":          site_info,
            "X-Zkdex-Env":          "0",
            "X-Simulated-Trading":  "0",

            # ── Device ────────────────────────────────────────────────────
            "Devid":                self.device_id,

            # ── Browser headers ───────────────────────────────────────────
            "Accept":               "application/json",
            "Accept-Language":      "en-US,en;q=0.9",
            "App-Type":             "web",
            "Cache-Control":        "no-cache",
            "Pragma":               "no-cache",
            "Referer":              referer,
            "User-Agent":           (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0"
            ),
            "Sec-Ch-Ua":            '"Chromium";v="146", "Not-A.Brand";v="24", "Microsoft Edge";v="146"',
            "Sec-Ch-Ua-Mobile":     "?0",
            "Sec-Ch-Ua-Platform":   '"Windows"',
            "Sec-Fetch-Dest":       "empty",
            "Sec-Fetch-Mode":       "cors",
            "Sec-Fetch-Site":       "same-origin",
        }
        return headers


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

DEVICE_ID = "3f2b8770-4353-4d81-8e8a-9130734cfc1a"


def test_apikey_generation():
    print("=" * 70)
    print("TEST: X-Apikey generation")
    print("=" * 70)

    key = ApiKeyGenerator.get_api_key()
    decoded = base64.b64decode(key).decode()
    api_part, time_part = decoded.split("|")

    print(f"  Raw key   : {key}")
    print(f"  Decoded   : {decoded}")
    print(f"  API part  : {api_part}")
    print(f"  Time part : {time_part}")
    assert api_part == "-b31e-4547-9299-b6d07b7631aba2c903cc", "API key rotate sai!"
    assert len(time_part) == len(str(int(time.time() * 1000) + ApiKeyGenerator.SALT)) + 3
    print("  ✓ Format đúng\n")


def test_minimal():
    print("=" * 70)
    print("TEST: Minimal headers (Verify + X-Apikey + Devid)")
    print("=" * 70)

    current_ts = int(time.time() * 1000)
    url = (
        f"https://www.oklink.com/api/explorer/v2/eth/tokens/holders/"
        f"0xdac17f958d2ee523a2206206994597c13d831ec7"
        f"?offset=0&limit=20&sort=value%2Cdesc&t={current_ts}"
    )

    signer  = OKLinkSigner(DEVICE_ID)
    headers = signer.get_headers(url)

    print("\nHeaders gửi đi:")
    for k, v in headers.items():
        print(f"  {k}: {v}")

    print("\nGọi API...")
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        data = resp.json()
        code = data.get("code")
        print(f"  Status : {resp.status_code}")
        print(f"  Code   : {code!r}  (type: {type(code).__name__})")
        print(f"  Message: {data.get('msg')!r}")
        print(f"  Keys   : {list(data.keys())}")
        # API trả về code là int 0 hoặc string "0" tuỳ endpoint
        if code == 0 or code == "0":
            print("\n  ✓✓✓ SUCCESS ✓✓✓")
            d = data.get("data", {})
            holders = d.get("hits") or d.get("holderList", [])
            print(f"\n  Total holders: {d.get('total', '?')}")
            print(f"  Lấy được {len(holders)} holders:")
            for h in holders[:5]:
                print(f"    #{h['rank']} {h['holderAddress']}  value={h['value']:.2f}  rate={h['rate']*100:.4f}%")
            return True
        else:
            print(f"\n  ✗ Thất bại — code={code!r}  msg={data.get('msg')!r}")
            print(f"  Full response: {data}")
            return False

    except Exception as e:
        print(f"  ✗ Exception: {e}")
        return False


def debug_time_sync():
    print("=" * 70)
    print("DEBUG: Time sync với server")
    print("=" * 70)

    import datetime
    from email.utils import parsedate_to_datetime

    local_ts = int(time.time() * 1000)
    print(f"  Local  : {local_ts}  ({datetime.datetime.fromtimestamp(local_ts / 1000)})")

    try:
        resp        = requests.head("https://www.oklink.com", timeout=5)
        server_date = resp.headers.get("Date")
        if server_date:
            server_ts = int(parsedate_to_datetime(server_date).timestamp() * 1000)
            diff      = local_ts - server_ts
            print(f"  Server : {server_ts}")
            print(f"  Diff   : {diff} ms ({diff / 1000:.2f}s)")
            if abs(diff) > 5000:
                print("  ⚠  Lệch > 5s — có thể gây VISIT_ALREADY_EXPIRED")
            else:
                print("  ✓ Time sync OK")
    except Exception as e:
        print(f"  Không check được server time: {e}")
    print()


if __name__ == "__main__":
    test_apikey_generation()
    debug_time_sync()
    test_minimal()