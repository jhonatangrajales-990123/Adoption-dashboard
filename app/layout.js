import './globals.css';

export const metadata = {
  title: 'Adoption · Alegra',
  description: 'Dashboard de adopción y migraciones — datos en vivo de HubSpot',
};

export default function RootLayout({ children }) {
  // Modo claro por defecto (así se ven los productos Alegra). El botón de tema
  // guarda la preferencia y este script la aplica antes del primer pintado, para
  // que no haya un parpadeo blanco al entrar en modo oscuro.
  // Orden: ?theme= en la URL (para compartir un enlace en un tema concreto) y si no,
  // la última preferencia guardada. Si no hay ninguna, se queda en claro.
  const temaInicial = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('ae_theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;if(q)localStorage.setItem('ae_theme',t);}}catch(e){}})();`;
  return (
    // suppressHydrationWarning: el script de arriba cambia data-theme antes de que
    // React hidrate, así que el HTML del servidor y el del cliente difieren a
    // propósito en ese atributo. Es la solución estándar para temas sin parpadeo.
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: temaInicial }} /></head>
      <body>{children}</body>
    </html>
  );
}
