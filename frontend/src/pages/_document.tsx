import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Viewport meta tag should be in _app.tsx, not here */}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

