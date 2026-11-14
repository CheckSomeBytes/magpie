import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './record.css';
import { Record } from './Record';

createRoot(document.getElementById('root')!).render(<Record />);
