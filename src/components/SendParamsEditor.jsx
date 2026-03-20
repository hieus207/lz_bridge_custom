const DEFAULT_EXTRA = "0x00030100110100000000000000000000000000030d40";

const SendParamsEditor = ({
  CHAINS,
  dstChain,
  setDstChain,
  sendParams,
  setSendParams,
}) => {
  const isUsingCustomExtra = sendParams?.extraOptions && sendParams.extraOptions !== "0x";

  const toggleExtra = () => {
    if (isUsingCustomExtra) {
      setSendParams((prev) => ({ ...prev, extraOptions: "0x" }));
      localStorage.setItem("lz_extraOptions", "0x");
    } else {
      setSendParams((prev) => ({ ...prev, extraOptions: DEFAULT_EXTRA }));
      localStorage.setItem("lz_extraOptions", DEFAULT_EXTRA);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm pt-3">
      {/* dstEid (Chain) */}
      <div className="flex gap-2 items-center">
        <label className="w-28 text-gray-500 text-xs font-medium">dstEid:</label>
        <select
          className="border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
          value={dstChain}
          onChange={(e) => {
            const chain = e.target.value;
            const newVal = CHAINS[chain] ?? sendParams.dstEid;
            setDstChain(chain);
            setSendParams((prev) => ({ ...prev, dstEid: newVal }));
          }}
        >
          {Object.keys(CHAINS).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="Custom">Custom</option>
        </select>
        <input
          type="number"
          value={sendParams.dstEid ?? ""}
          onChange={(e) => {
            setSendParams((prev) => ({ ...prev, dstEid: e.target.value }));
            setDstChain("Custom");
          }}
          className="w-24 border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
        />
      </div>

      {/* Other params */}
      {Object.entries(sendParams).map(([key, value]) => {
        if (key === "dstEid") return null;
        const isExtra = key === "extraOptions";
        return (
          <div key={key} className="flex gap-2 items-center">
            <label className="w-28 text-gray-500 text-xs font-medium">{key}:</label>
            <input
              type="text"
              className="flex-1 border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300 font-mono"
              value={value}
              onChange={(e) => {
                const newVal = e.target.value;
                setSendParams((prev) => ({ ...prev, [key]: newVal }));
                if (isExtra && newVal && newVal !== "0x") {
                  localStorage.setItem("lz_extraOptions", newVal);
                }
              }}
            />
            {isExtra && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExtra(); }}
                className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border cursor-pointer transition text-sm ${
                  isUsingCustomExtra
                    ? "bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100"
                    : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100"
                }`}
                title={isUsingCustomExtra ? "Switch to 0x (default)" : "Load saved extraOptions"}
              >
                &#8644;
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SendParamsEditor;
