
import React from 'react';

interface HoneypotProps {
  value: string;
  onChange: (value: string) => void;
}

const Honeypot: React.FC<HoneypotProps> = ({ value, onChange }) => {
  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      <label htmlFor="website">Website (leave blank)</label>
      <input
        type="text"
        id="website"
        name="website"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );
};

export default Honeypot;
