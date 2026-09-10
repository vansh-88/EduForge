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
    primary: 'bg-primary text-white hover:bg-primary-hover focus:ring-primary disabled:bg-primary-weak',
    secondary: 'bg-surface text-body border border-line-strong hover:bg-subtle focus:ring-primary disabled:bg-subtle disabled:text-faint',
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