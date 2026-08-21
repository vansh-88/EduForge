export const Select = ({ label, error, options, className = '', ...props }) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select
        className={`px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-1 sm:text-sm transition-colors bg-white
          ${error 
            ? 'border-red-500 text-red-900 focus:ring-red-500 focus:border-red-500' 
            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
          }`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className="text-sm text-red-500 mt-1">{error}</span>}
    </div>
  );
};