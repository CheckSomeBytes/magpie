import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './library.css';
import { Library } from './Library';

createRoot(document.getElementById('root')!).render(<Library />);
