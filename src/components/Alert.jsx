import { useEffect, useState } from "react";

const Alert = ({ type = "info", message, onClose, duration = 10000 }) => {
  const [visible, setVisible] = useState(true);

  const baseStyle =
    "fixed top-4 right-4 p-3 rounded-lg flex items-center gap-2 shadow-lg border z-50 transition-opacity duration-500";
  const styles = {
    success: {
      bg: "bg-green-50 border-green-300 text-green-800",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-green-600 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ),
      linkClass: "text-green-700 hover:text-green-900",
    },
    error: {
      bg: "bg-red-50 border-red-300 text-red-800",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-red-600 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      ),
      linkClass: "text-red-700 hover:text-red-900",
    },
    warning: {
      bg: "bg-yellow-50 border-yellow-300 text-yellow-800",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-yellow-600 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M12 5a7 7 0 100 14a7 7 0 000-14z"
          />
        </svg>
      ),
      linkClass: "text-yellow-700 underline hover:text-yellow-900",
    },
    info: {
      bg: "bg-blue-50 border-blue-300 text-blue-800",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-blue-600 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20a10 10 0 000-20z"
          />
        </svg>
      ),
      linkClass: "text-blue-700 underline hover:text-blue-900",
    },
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        if (onClose) onClose();
      }, 500); // đợi fade out
    }, duration);

    return () => clearTimeout(timer);
  }, [onClose, duration]);

  if (!visible) return null;

  return (
    <div className={`${baseStyle} ${styles[type].bg} opacity-100`}>
      {styles[type].icon}
      <span
        className={`font-medium [&>a]:${styles[type].linkClass}`}
        dangerouslySetInnerHTML={{ __html: message }}
      />
      {onClose && (
        <button
          onClick={() => setVisible(false)}
          className="ml-2 text-sm text-gray-500 hover:text-gray-700"
        >
          ✖
        </button>
      )}
    </div>
  );
};

export default Alert;
