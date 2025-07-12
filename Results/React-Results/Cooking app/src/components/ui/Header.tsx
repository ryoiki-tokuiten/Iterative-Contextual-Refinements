import React from 'react';
import { Link, NavLink } from 'react-router-dom';

const Header: React.FC = () => {
  const activeLinkClass = 'text-yellow-400';
  const inactiveLinkClass = 'text-white hover:text-yellow-300 transition-colors';

  const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? activeLinkClass : inactiveLinkClass;

  return (
    <header className="bg-gray-800 text-white shadow-md">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="text-2xl font-bold tracking-tight">
          🍳 Flavor Fusion
        </Link>
        <ul className="flex items-center space-x-6 text-lg">
          <li>
            <NavLink to="/" className={getNavLinkClass} end>
              Home
            </NavLink>
          </li>
          <li>
            <NavLink to="/recipes" className={getNavLinkClass}>
              Recipes
            </NavLink>
          </li>
        </ul>
      </nav>
    </header>
  );
};

export default Header;
