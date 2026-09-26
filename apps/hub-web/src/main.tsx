import './lib/i18n';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import * as ReactDOM from 'react-dom/client';
import { createHubRouter } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The hub is a handful of small reads; refetching them on every window
      // focus buys nothing and makes a signed-out session look like a flicker.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const router = createHubRouter(queryClient);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
