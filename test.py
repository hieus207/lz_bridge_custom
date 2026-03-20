#!/usr/bin/env python3
"""
OKLink API - Top Holder Scanner
Test OKLink Explorer API to get token holders
"""

import requests
import json
import time

# OKLink chain slug mapping
OKLINK_CHAINS = {
    1: "eth",
    56: "bsc",
    137: "polygon",
    43114: "avax",
    42161: "arbitrum",
    10: "optimism",
    8453: "base",
}

CONTRACT = "0x32b4d049fe4c888d2b92eecaf729f44df6b1f36e"
CHAIN_ID = 1


def get_holders(chain_id, token_address, limit=50, api_key=None):
    """Fetch top holders from OKLink API v5"""
    
    chain_slug = OKLINK_CHAINS.get(chain_id)
    if not chain_slug:
        print(f"Chain {chain_id} not supported")
        return None
    
    # OKLink official API v5
    url = "https://www.oklink.com/api/v5/explorer/token/token-holder-list"
    params = {
        "chainShortName": chain_slug,
        "tokenContractAddress": token_address,
        "page": "1",
        "limit": str(limit),
    }
    
    headers = {
        "Accept": "*/*",
        "Ok-Access-Key": api_key or "",
    }
    
    print(f"Fetching top {limit} holders...")
    print(f"URL: {url}")
    print(f"Chain: {chain_slug}")
    
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    print(f"Status: {resp.status_code}")
    
    data = resp.json()
    print(f"Response code: {data.get('code')}")
    
    if str(data.get("code")) != "0":
        print(f"Error: {data.get('msg', 'Unknown error')}")
        # Print full response for debugging
        print(f"Full response: {json.dumps(data, indent=2)[:500]}")
        return None
    
    return data.get("data", [])


def display_holders(data):
    """Display holders results"""
    
    if not data:
        print("No holder data")
        return
    
    # v5 API returns list of pages, first item has holderList
    page = data[0] if isinstance(data, list) and data else data
    hits = page.get("holderList") or page.get("hits", [])
    
    if not hits:
        print("No holders found")
        print(f"Raw data keys: {page.keys() if isinstance(page, dict) else type(page)}")
        return
    
    print(f"\nReturned: {len(hits)} holders")
    print()
    
    print(f"{'#':<4} {'Address':<44} {'Pct %':<12} {'Value':<18}")
    print("-" * 85)
    
    contract_candidates = []
    
    for i, h in enumerate(hits, 1):
        addr = h.get("holderAddress", h.get("address", "?"))
        # v5 uses positionList format or direct fields
        pct_str = h.get("holdingPercent", h.get("rate", "0"))
        amount = h.get("amount", h.get("value", "0"))
        
        pct = float(pct_str) if pct_str else 0
        # If rate is 0.25 meaning 25%, adjust
        if pct > 0 and pct < 1:
            pct_display = pct * 100
        else:
            pct_display = pct
        
        value = float(amount) if amount else 0
        
        # Format value
        if value >= 1e9:
            val_str = f"{value/1e9:.2f}B"
        elif value >= 1e6:
            val_str = f"{value/1e6:.2f}M"
        elif value >= 1e3:
            val_str = f"{value/1e3:.2f}K"
        else:
            val_str = f"{value:.2f}"
        
        marker = ""
        # Check if contract type is indicated
        is_contract = h.get("holderAddressType") == "contract" or h.get("isContract", False)
        if is_contract and 0.2 <= pct_display <= 15:
            marker = " <-- OFT candidate"
            contract_candidates.append(h)
        
        type_str = "contract" if is_contract else ""
        print(f"{i:<4} {addr:<44} {pct_display:.4f}%     {val_str} {type_str}{marker}")
    
    print("-" * 85)
    
    print(f"\nOFT Candidates (contract, 0.2%-15%): {len(contract_candidates)}")
    for c in contract_candidates:
        addr = c.get("holderAddress", c.get("address", "?"))
        print(f"  {addr}")


def main():
    print("=" * 60)
    print("OKLink API - Token Holder Scanner")
    print("=" * 60)
    
    # Test with API key
    API_KEY = "a7fd4fa6-1769-42bf-a155-833e803cdb64"
    data = get_holders(CHAIN_ID, CONTRACT, limit=50, api_key=API_KEY)
    
    if data:
        display_holders(data)
        
        # Save raw response
        with open("oklink_holders.json", "w") as f:
            json.dump(data, f, indent=2)
        print("\nSaved to oklink_holders.json")
    else:
        print("\nFailed. Might need API key.")
        print("Get one at: https://www.oklink.com/account/my-api")
        print("Then pass api_key='your_key' to get_holders()")


if __name__ == "__main__":
    main()