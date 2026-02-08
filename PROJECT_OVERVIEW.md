# 📖 TÓM TẮT DỰ ÁN - LZ BRIDGE CUSTOM

## 🎯 TỔNG QUAN
Dự án React.js đa chức năng bao gồm:
1. **Bridge LayerZero (OFT)** - Chuyển token cross-chain qua LayerZero
2. **Solana Launchpad** - Tương tác với chương trình launchpad trên Solana

---

## 🏗️ KIẾN TRÚC DỰ ÁN

```
lz_bridge_custom/
├── public/                    # Static files
├── src/
│   ├── pages/
│   │   ├── Bridge.jsx        # 🌉 Trang Bridge LayerZero
│   │   ├── Solana.jsx        # 🚀 Trang Solana Launchpad
│   │   └── Dashboard.jsx     # 📊 Trang chủ (placeholder)
│   ├── components/
│   │   ├── BridgeButton.jsx  # Logic bridge chính
│   │   ├── SendParamsEditor.jsx # Editor params
│   │   └── Alert.jsx         # Component thông báo
│   ├── hooks/
│   │   ├── useWallet.js      # Hook kết nối ví EVM (MetaMask, OKX)
│   │   └── useSolanaWallet.js # Hook kết nối ví Solana
│   ├── abis/
│   │   └── OFT.json          # ABI của OFT contract
│   ├── idl/
│   │   └── launchpad.json    # IDL của Solana program
│   ├── App.js                # Router chính
│   └── index.js              # Entry point
├── package.json
├── craco.config.js           # CRACO config cho polyfills
└── tailwind.config.js        # TailwindCSS config
```

---

## 🔧 CÔNG NGHỆ SỬ DỤNG

### Frontend Framework
- **React 19.1.1** - UI framework
- **React Router v7** - Navigation
- **TailwindCSS** - Styling
- **Lucide React** - Icons

### Blockchain Libraries
#### EVM Ecosystem
- **ethers.js v6** - Tương tác Ethereum/EVM chains
- Hỗ trợ LayerZero OFT (Omnichain Fungible Token)

#### Solana Ecosystem
- **@solana/web3.js** - Core Solana library
- **@solana/spl-token** - SPL Token interactions
- **@project-serum/anchor** - Solana program framework
- **@coral-xyz/anchor** - Modern Anchor SDK

### Build Tools
- **Create React App (CRA)** với **CRACO** - Webpack customization
- **Autoprefixer & PostCSS** - CSS processing

### Polyfills (cho Web3)
- `buffer`, `crypto-browserify`, `stream-browserify`, `process`, `events`, `assert`, `util`, `path-browserify`, `browserify-zlib`

---

## 📄 CHI TIẾT CÁC TRANG

### 1️⃣ Bridge Page (`/bridge`)

**Chức năng:**
- Kết nối ví EVM (MetaMask, OKX Wallet)
- Bridge token qua LayerZero OFT
- Hỗ trợ nhiều chain: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, Sonic
- Auto-quote phí bridge
- Check và approve token tự động
- Tùy chỉnh SendParams (gas, nonce, refund address...)
- Hỗ trợ custom RPC

**Workflow:**
1. User nhập địa chỉ OFT contract
2. Chọn chain đích (destination chain)
3. Nhập số lượng token
4. Kiểm tra fee quote
5. Approve token (nếu cần)
6. Gửi transaction bridge

**URL Parameters:**
- `?oftadr=<địa_chỉ_contract>` - Auto-fill OFT address
- `?chainId=<chain_id>` - Auto-switch chain
- `?auto=true` - Auto-check khi load

**Các chain được hỗ trợ (LayerZero EID):**
```javascript
Ethereum: 30101
BSC: 30102
Polygon: 30109
Arbitrum: 30110
Optimism: 30111
Avalanche: 30106
Sonic: 30332
Base: 30184
Solana: 30168
```

---

### 2️⃣ Solana Page (`/solana`)

**Chức năng:**
- Kết nối ví Solana (Phantom, Solflare, OKX Solana)
- Tương tác với chương trình Launchpad trên Solana
- Fund vào launch pool bằng USDC
- Theo dõi thông tin launch real-time
- Auto-refresh launch info
- Alert khi launch hoàn thành (có âm thanh)

**Thông tin Launch hiển thị:**
- Trạng thái launch (idle, started, complete, cancelled)
- Thời gian còn lại
- Tổng base token đã bán
- Tổng USDC đã thu
- Số lượng contributor
- Thông tin user: số USDC đã fund, số token sẽ nhận, đã claim chưa

**Workflow:**
1. Kết nối ví Solana
2. Xem thông tin launch hiện tại
3. Nhập số USDC muốn fund
4. Click "Fund" để tham gia
5. Sau khi launch complete, có thể claim token

**Config:**
```javascript
PROGRAM_ID: MooNyh4CBUYEKyXVnjGYQ8mEiJDpGvJMdvrZx1iGeHV
LAUNCH: E7kXdSdZrjVFDkLb6V7S8VihKookPviRJ7tXVik9qbdu
MINT (Token): BANKJmvhT8tiJRsBSS1n2HryMBPvT5Ze4HU95DUAmeta
USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
RPC: QuickNode Mainnet
```

**Tính năng đặc biệt:**
- ⏱️ Countdown timer real-time
- 🔔 Alert với âm thanh tùy chỉnh khi launch hoàn thành
- 🔄 Auto-refresh info theo interval
- 📊 Hiển thị chi tiết quota/cap cho từng user

---

### 3️⃣ Dashboard Page (`/`)
- Trang placeholder đơn giản
- Có link điều hướng đến Bridge và Solana

---

## 🎨 COMPONENTS

### `<BridgeButton />` (643 dòng)
Component phức tạp nhất của dự án, xử lý:
- Kết nối với OFT contract
- Quote fee từ LayerZero
- Approve ERC20 token
- Gửi transaction bridge
- Xử lý custom RPC
- Hỗ trợ switch chain
- SendParams editor tùy chỉnh
- Theo dõi trạng thái transaction

### `<SendParamsEditor />` 
Editor để tùy chỉnh params gửi cho LayerZero:
- `to` (recipient address ở chain đích)
- `extraOptions` (gas settings, native drop)
- `composeMsg` (compose message)
- `onoftReceivedMsg` (callback message)
- `refundAddress` (địa chỉ nhận phí thừa)

### `<Alert />`
Component hiển thị thông báo với 3 loại:
- ✅ Success (xanh)
- ⚠️ Warning (vàng)
- ❌ Error (đỏ)
- ℹ️ Info (xanh dương)

---

## 🔌 HOOKS

### `useWallet()`
Custom hook quản lý kết nối ví EVM:
- Kết nối MetaMask/OKX Wallet
- Auto-connect khi reload
- Lấy signer để ký transaction
- Detect multiple providers

### `useSolanaWallet()`
Custom hook quản lý kết nối ví Solana:
- Kết nối Phantom/Solflare/OKX Solana
- Trả về signer object cho Anchor
- Disconnect wallet

---

## 📦 DEPENDENCIES CHÍNH

```json
{
  "react": "19.1.1",
  "react-dom": "19.1.1",
  "react-router-dom": "^7.8.2",
  "ethers": "^6.15.0",
  "@solana/web3.js": "^1.98.4",
  "@solana/spl-token": "^0.4.14",
  "@project-serum/anchor": "^0.26.0",
  "@coral-xyz/anchor": "^0.32.1",
  "tailwindcss": "^3.4.17",
  "lucide-react": "^0.546.0",
  "@craco/craco": "^7.1.0"
}
```

---

## 🚀 CÁCH CHẠY DỰ ÁN

### 1. Cài đặt dependencies
```bash
npm install
```
hoặc nếu gặp lỗi peer dependency:
```bash
npm install --legacy-peer-deps
```

### 2. Chạy dev server
```bash
npm start
```
App sẽ chạy tại `http://localhost:3000`

### 3. Build production
```bash
npm run build
```

---

## ⚠️ LƯU Ý QUAN TRỌNG

### Version Lock
- React và React-DOM phải **CHÍNH XÁC cùng version** (hiện tại lock tại `19.1.1`)
- Không dùng `^` ở trước version để tránh auto-update gây conflict

### Polyfills
- Đã config CRACO để inject polyfills cho Node.js modules trong browser
- Cần thiết cho các thư viện crypto/blockchain

### Multi-Wallet Support
Dự án hỗ trợ:
- **EVM**: MetaMask, OKX Wallet
- **Solana**: Phantom, Solflare, OKX Solana Wallet

### Custom RPC
- Bridge page có thể dùng custom RPC endpoint
- Hữu ích khi public RPC quá rate limit

---

## 🔐 SECURITY CONSIDERATIONS

1. **Private Key**: KHÔNG BAO GIỜ commit private key vào git
2. **RPC Endpoints**: Nên dùng private RPC cho production
3. **Contract Address**: Luôn verify contract trước khi tương tác
4. **Allowance**: Chỉ approve đúng số lượng cần thiết
5. **Slippage**: Tính toán fee quote trước khi bridge

---

## 🐛 TROUBLESHOOTING

### Lỗi compile (Webpack 5 polyfills)
→ Đã fix bằng CRACO config

### React version mismatch
→ Đã lock cả `react` và `react-dom` tại `19.1.1`

### `@vercel/analytics` conflict
→ Đã remove khỏi dependencies

### Solana transaction fails
→ Kiểm tra:
- Đủ SOL cho phí transaction
- Đủ USDC để fund
- Launch đang trong trạng thái "started"

---

## 📞 LIÊN HỆ & MỞ RỘNG

### Có thể mở rộng:
1. Thêm chain khác vào Bridge (cần EID LayerZero)
2. Hỗ trợ multiple launch pools cho Solana
3. Thêm lịch sử transaction
4. Wallet history tracking
5. Portfolio dashboard

### Tech Debt:
- [ ] Tách logic phức tạp ra khỏi BridgeButton (~600 dòng)
- [ ] Thêm unit tests
- [ ] Error boundary cho React
- [ ] Optimize re-renders
- [ ] Add proper TypeScript

---

## 📚 TÀI LIỆU THAM KHẢO

- **LayerZero Docs**: https://docs.layerzero.network/
- **OFT Standard**: https://docs.layerzero.network/contracts/oft
- **Solana Docs**: https://docs.solana.com/
- **Anchor Framework**: https://www.anchor-lang.com/
- **Ethers.js v6**: https://docs.ethers.org/v6/

---

**Generated:** February 8, 2026  
**Version:** 0.1.0  
**Tech Stack:** React 19 + Ethers 6 + Solana Web3.js + TailwindCSS
