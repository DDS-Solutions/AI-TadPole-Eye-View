import { mount } from 'svelte';
import App from './App.svelte';
import './hudTokens.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Target element #app not found in document');
}

const app = mount(App, {
  target,
});

export default app;
