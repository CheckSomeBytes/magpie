import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './home.css';
import { Home } from './Home';

createRoot(document.getElementById('root')!).render(<Home />);
