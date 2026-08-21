import { Button } from './Button';

export const ErrorState = ({ 
  title = 'Something went wrong', 
  message, 
  onRetry,
  className = ''
}) => {
  return (
    <div className={`bg-red-50 border border-red-200 rounded-lg p-6 text-center ${className}`}>
      <h3 className="text-sm font-semibold text-red-800">{title}</h3>
      {message && (
        <p className="mt-2 text-sm text-red-600 mb-4">{message}</p>
      )}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
};