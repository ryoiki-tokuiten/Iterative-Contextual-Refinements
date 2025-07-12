import React from 'react';

interface TagProps {
  label: string;
  className?: string;
}

const Tag: React.FC<TagProps> = ({ label, className }) => {
  return (
    <span
      className={`inline-block bg-amber-100 text-amber-800 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full ${className}`}
    >
      {label}
    </span>
  );
};

export default Tag;
