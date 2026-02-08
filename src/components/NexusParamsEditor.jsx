const NexusParamsEditor = ({
  CHAINS,
  dstChain,
  setDstChain,
  nexusParams,
  setNexusParams,
}) => {
  return (
    <div className="bg-gray-50 border p-3 rounded-lg flex flex-col gap-2 text-sm">
      {/* Title */}
      <div className="font-semibold text-center text-lg">
        Nexus Params (customizable)
      </div>

      {/* destination (Chain) */}
      <div className="flex gap-2 items-center">
        <label className="w-28 font-medium">destination (Chain):</label>
        <select
          className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={dstChain}
          onChange={(e) => {
            const chain = e.target.value;
            const newVal = CHAINS[chain] ?? nexusParams.destination;
            setDstChain(chain);
            setNexusParams((prev) => ({ ...prev, destination: newVal }));
          }}
        >
          {Object.keys(CHAINS).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="Custom">Custom</option>
        </select>

        <input
          type="number"
          value={nexusParams.destination ?? ""}
          onChange={(e) => {
            setNexusParams((prev) => ({ ...prev, destination: e.target.value }));
            setDstChain("Custom");
          }}
          className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* recipient (bytes32) */}
      <div className="flex gap-2 items-center">
        <label className="w-28 font-medium">recipient:</label>
        <input
          type="text"
          className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono text-xs"
          value={nexusParams.recipient}
          onChange={(e) =>
            setNexusParams((prev) => ({ ...prev, recipient: e.target.value }))
          }
        />
      </div>

      {/* amount (wei) */}
      <div className="flex gap-2 items-center">
        <label className="w-28 font-medium">amount:</label>
        <input
          type="text"
          className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
          value={nexusParams.amount}
          onChange={(e) =>
            setNexusParams((prev) => ({ ...prev, amount: e.target.value }))
          }
        />
      </div>

      {/* hookMetadata (optional) */}
      <details>
        <summary className="cursor-pointer font-medium text-gray-600 hover:text-gray-800">
          Advanced Options (optional)
        </summary>
        <div className="mt-2 space-y-2 pl-2">
          <div className="flex gap-2 items-center">
            <label className="w-28 font-medium text-xs">hookMetadata:</label>
            <input
              type="text"
              className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono text-xs"
              value={nexusParams.hookMetadata}
              onChange={(e) =>
                setNexusParams((prev) => ({ ...prev, hookMetadata: e.target.value }))
              }
              placeholder="0x (bytes)"
            />
          </div>

          <div className="flex gap-2 items-center">
            <label className="w-28 font-medium text-xs">hook:</label>
            <input
              type="text"
              className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono text-xs"
              value={nexusParams.hook}
              onChange={(e) =>
                setNexusParams((prev) => ({ ...prev, hook: e.target.value }))
              }
              placeholder="0x... (hook address)"
            />
          </div>
        </div>
      </details>
    </div>
  );
};

export default NexusParamsEditor;
