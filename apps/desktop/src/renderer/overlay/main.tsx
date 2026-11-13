import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './overlay.css';
import { Overlay } from './Overlay';

createRoot(document.getElementById('root')!).render(<Overlay />);
