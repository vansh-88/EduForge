import { Button } from './Button';

export const ErrorState = ({ 
  title = 'Something went wrong', 
  message, 
  onRetry,
  className = ''
}) => {
  return (
    <div className={`bg-danger-soft border border-danger-line rounded-lg p-6 text-center ${className}`}>
      <h3 className="text-sm font-semibold text-danger-strong">{title}</h3>
      {message && (
        <p className="mt-2 text-sm text-danger-text mb-4">{message}</p>
      )}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
};