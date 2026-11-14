import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './scroll.css';
import { Scroll } from './Scroll';

createRoot(document.getElementById('root')!).render(<Scroll />);
