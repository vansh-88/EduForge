import { Spinner } from './Spinner';

export const Button = ({
  variant = 'primary',
  disabled = false,
  loading = false,
  children,
  className = '',
  ...props
}) => {
  const baseStyles = 'inline-flex justify-center items-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200';
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:bg-blue-300',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400',
  };

  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`${baseStyles} ${variants[variant]} ${isDisabled ? 'cursor-not-allowed opacity-70' : ''} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size="sm" className="mr-2" />
          Loading...
        </>
      ) : (
        children
      )}
    </button>
  );
};