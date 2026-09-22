const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  const pwaTags = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="PeSiMistas" />
  `;

  if (!html.includes('rel="manifest"')) {
    html = html.replace('</head>', `${pwaTags}</head>`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('✅ Postbuild: High-resolution icons and PWA manifest injected into dist/index.html');
  } else {
    console.log('ℹ️ Postbuild: dist/index.html already contains manifest link.');
  }
} else {
  console.log('⚠️ Postbuild: dist/index.html not found.');
}
