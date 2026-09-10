export const Skeleton = ({ className = '' }) => {
  return (
    <div 
      className={`animate-pulse bg-subtle rounded-md ${className}`} 
      aria-hidden="true" 
    />
  );
};