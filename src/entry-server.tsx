import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { createHead, UnheadProvider } from '@unhead/react/server';
import { AppRoutes } from '../EasyEditsApp';

export const renderLanding = (location = '/') => {
  const head = createHead();
  const html = renderToString(
    <React.StrictMode>
      <UnheadProvider value={head}>
        <StaticRouter location={location}>
          <AppRoutes />
        </StaticRouter>
      </UnheadProvider>
    </React.StrictMode>,
  );
  return { html, head };
};
