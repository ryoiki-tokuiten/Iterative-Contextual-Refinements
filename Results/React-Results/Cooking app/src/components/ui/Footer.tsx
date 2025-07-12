import React from 'react';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-800 text-gray-400">
      <div className="container mx-auto px-4 py-4 text-center">
        <p>&copy; {currentYear} Flavor Fusion. All Rights Reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
