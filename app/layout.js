import './globals.css';

export const metadata = {
  title: 'Adoption Explorer · Alegra',
  description: 'Dashboard interactivo de tickets de Adoption (HubSpot en vivo)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
