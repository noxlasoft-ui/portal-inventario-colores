# Portal de pedidos · COISA HOGAR

Aplicación local, adaptable a teléfono y computadora, para consultar el inventario exportado desde Stellar y preparar notas de pedido. La misma interfaz se puede instalar como aplicación web progresiva (PWA) y empaquetar para escritorio con Tauri.

## Uso diario

1. Pulsa **Actualizar desde repositorio** para cargar el XML central, o selecciona **Archivo XML** para usar un archivo de Stellar. También puedes arrastrar un XML al recuadro en una computadora.
2. La aplicación valida el archivo antes de guardarlo en el dispositivo. Si ya existe un inventario local, el botón de repositorio pide confirmación; al publicar un XML nuevo no se reemplazan automáticamente los datos guardados en los teléfonos y computadoras.
3. Busca por código, descripción, marca o departamento; selecciona un producto, indica cantidad y unidad, y agrégalo al pedido. Para persianas, también debes elegir el color; el código y nombre elegidos aparecen en su renglón y en el Excel. Para continuar un pedido existente, activa **Reposición desde Excel** y elige su archivo `.xlsx`; los renglones se agregan al pedido actual. Los códigos que falten en el inventario quedan marcados para revisar y bloquean la descarga hasta corregirlos.
4. Descarga el archivo `.xlsx` cuando termines. La primera hoja conserva el formato del ejemplo de Valencia —logo, encabezado, ubicación, tabla y cantidades con unidad— y muestra el color elegido para cada persiana. La segunda hoja `Base_Inventario` incluye los datos del XML, incluidos costos y precios.

Los productos, el último inventario válido y el borrador se guardan en IndexedDB en el perfil local del navegador o de la aplicación de escritorio. Los cambios del pedido se guardan automáticamente. No se suben pedidos ni hay sincronización entre dispositivos; el XML central sí forma parte del sitio público y puede ser descargado por cualquier visitante. El XML incluye datos comerciales como costos y precios: no publiques allí información que deba ser confidencial. Mantén una copia segura del XML original. Al compartir un Excel, ten presente que también contiene la hoja completa del inventario y los costos.

## Actualizar el XML central

Reemplaza `public/INVENTARIO.xml` en el repositorio y publica los cambios. La nueva versión queda disponible en el sitio, pero los dispositivos que ya guardaron un inventario conservan su versión hasta que alguien pulse **Actualizar desde repositorio** y confirme el reemplazo. Un dispositivo nuevo carga el archivo central la primera vez que abre el portal. El XML se solicita sin caché del navegador o del service worker para evitar servir una copia antigua.

El XML debe corresponder al reporte de Stellar `ReporteStellar` y contener registros `Registro` con código, descripción y estado activo. Los códigos de producto repetidos se rechazan para evitar agregar artículos ambiguos. Archivos de más de 20 MB no se procesan.

## Desarrollo web y PWA

Requiere Node.js y npm.

### Portal publicado

La versión web se publica automáticamente en [https://noxlasoft-ui.github.io/portal-inventario-colores/](https://noxlasoft-ui.github.io/portal-inventario-colores/) al subir cambios a GitHub. Abre ese enlace en el navegador de tu teléfono o computadora. En el teléfono puedes usar **Añadir a pantalla de inicio** (o **Instalar app**, si aparece) para abrirlo como aplicación.

El enlace publicado y el XML central son públicos. Los pedidos y los inventarios importados localmente permanecen en el dispositivo y no se sincronizan entre dispositivos.

```sh
npm install
npm run dev
```

Para validar la aplicación y generar los archivos estáticos:

```sh
npm test
npm run build
npm run preview
```

`npm run build` también crea `portal.html`, un archivo único que puedes abrir directamente en el navegador para cargar el inventario sin instalar herramientas adicionales en esa computadora. No abras el `index.html` fuente directamente: necesita Vite para cargar sus módulos.

Para instalarla como PWA, publica `dist/` en un sitio servido por HTTPS y ábrelo desde el navegador del teléfono o la computadora. La primera visita necesita conexión para guardar la interfaz; después, el portal puede abrirse sin conexión en ese mismo dispositivo.

## Aplicación de escritorio

Requiere Rust, las herramientas de compilación de Tauri 2 y los prerrequisitos nativos de Tauri de tu sistema operativo. En Linux se necesitan las bibliotecas GTK y WebKitGTK; Windows requiere las herramientas de compilación de Microsoft y WebView2.

```sh
npm run desktop:dev
npm run desktop:build
```

El comando de escritorio genera los iconos de plataforma desde el SVG incluido y después crea instaladores para Windows (`.msi`, `.nsis`) o Linux (`.deb`, `.rpm`, `.AppImage`) según el sistema anfitrión y las herramientas instaladas. Para distribuir ambos sistemas, genera cada conjunto de instaladores en su plataforma correspondiente.

## Datos y atribución

**Derechos de la aplicación: JORGE ALBERTO PAREJO LANDINEZ.** La atribución se refiere a esta aplicación y no afirma titularidad sobre COISA HOGAR, Stellar, sus marcas, logotipos o los datos comerciales del inventario. No hay cuentas ni controles de acceso en esta primera versión; protege el dispositivo y los archivos descargados de acuerdo con las necesidades del negocio.
