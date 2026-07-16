import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface SideMenuContextType {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const SideMenuContext = createContext<SideMenuContextType>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function SideMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((p) => !p), []);

  return (
    <SideMenuContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </SideMenuContext.Provider>
  );
}

export const useSideMenu = () => useContext(SideMenuContext);
