export const WelcomeSection = ({ user }) => {
  const firstName = user?.name?.split(' ')[0];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
      </h1>
      <p className="mt-1 text-sm text-gray-500">Pick up where you left off, or start something new.</p>
    </div>
  );
};
