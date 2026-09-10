export const Input = ({ label, error, className = '', ...props }) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-body">
          {label}
        </label>
      )}
      <input
        className={`px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-1 sm:text-sm transition-colors
          ${error 
            ? 'border-danger text-danger-strong focus:ring-danger focus:border-danger' 
            : 'border-line-strong focus:ring-primary focus:border-primary'
          }`}
        {...props}
      />
      {error && <span className="text-sm text-danger mt-1">{error}</span>}
    </div>
  );
};