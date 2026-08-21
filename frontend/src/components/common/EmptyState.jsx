import { Button } from './Button';

export const EmptyState = ({ 
  title, 
  description, 
  actionLabel, 
  onAction, 
  children,
  className = ''
}) => {
  return (
    <div className={`text-center py-12 px-4 border-2 border-dashed border-gray-300 rounded-lg ${className}`}>
      <h3 className="mt-2 text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500 mb-6">{description}</p>
      
      {/* Either use the provided action label/handler, or render custom children */}
      {actionLabel && onAction ? (
        <Button onClick={onAction}>{actionLabel}</Button>
      ) : (
        children
      )}
    </div>
  );
};