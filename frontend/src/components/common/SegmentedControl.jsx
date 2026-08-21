export const SegmentedControl = ({ options, value, onChange, className = '' }) => {
  return (
    <div className={`flex w-full bg-gray-100 p-1 rounded-lg ${className}`}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
              isActive
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};