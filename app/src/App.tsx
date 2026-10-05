import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { useAuth } from './store/auth';
import { queryClient, useLiveMode } from './store/live';
import { startSync } from './store/sync';

/* Loading and saving the workspace follows the store from now on. */
startSync();

/** Asks the server who is signed in, keeps the session alive while the person is active, and follows the server's state; renders nothing. */
function Connection() { useAuth(); useLiveMode(); return null; }

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Connection />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
