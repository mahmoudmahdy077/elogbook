export const metadata = {
  title: 'E-Logbook Setup',
  description: 'Initial setup wizard for E-Logbook',
};

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-full max-w-2xl mx-4">
        {children}
      </div>
    </div>
  );
}
