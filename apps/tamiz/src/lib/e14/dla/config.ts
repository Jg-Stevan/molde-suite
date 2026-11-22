// Turbopack no inlinea process.env dentro de los paquetes de workspace; la app
// fija aquí las URLs que dla-onnx debe usar antes de cualquier configuracionLista.
import { configurarModelo } from '@jg-stevan/dla-onnx';

configurarModelo('layout', process.env.NEXT_PUBLIC_DLA_MODELO_LAYOUT);
configurarModelo('casillas', process.env.NEXT_PUBLIC_DLA_MODELO_CASILLAS);
configurarModelo('manuscrito', process.env.NEXT_PUBLIC_DLA_MODELO_MANUSCRITO);
