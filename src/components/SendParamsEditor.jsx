const SendParamsEditor = ({
  CHAINS,
  dstChain,
  setDstChain,
  dstEidValue,
  setDstEidValue,
  sendParams,
  setSendParams,
}) => {
  return (
    <div className="bg-gray-50 border p-3 rounded-lg flex flex-col gap-2 text-sm">
      {/* Dòng tiêu đề chỉnh to và căn giữa */}
      <div className="font-semibold text-center text-lg">Send Params (customizable)</div>

      <div className="flex gap-2 items-center">
        <label className="w-28 font-medium">dstEid (Chain):</label>
        <select
          className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={dstChain}
          onChange={(e) => {
            const chain = e.target.value;
            setDstChain(chain);
            setDstEidValue(CHAINS[chain] ?? dstEidValue);
          }}
        >
          {Object.keys(CHAINS).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="number"
          value={dstEidValue ?? ""}
          onChange={(e) => {
            setDstEidValue(e.target.value);
            setDstChain("Custom");
          }}
          className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {Object.entries(sendParams).map(([key, value]) => {
        if (key === "dstEid") return null;
        return (
          <div key={key} className="flex gap-2 items-center">
            <label className="w-28 font-medium">{key}:</label>
            <input
              type="text"
              className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={value}
              onChange={(e) =>
                setSendParams((prev) => ({ ...prev, [key]: e.target.value }))
              }
            />
          </div>
        );
      })}
    </div>
  );
};

export default SendParamsEditor;
