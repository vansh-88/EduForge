export const Skeleton = ({ className = '' }) => {
  return (
    <div 
      className={`animate-pulse bg-gray-200 rounded-md ${className}`} 
      aria-hidden="true" 
    />
  );
};