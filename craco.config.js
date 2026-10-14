    const webpack = require('webpack');

    module.exports = {
      webpack: {
        configure: (webpackConfig) => {
          webpackConfig.resolve.fallback = {
            ...webpackConfig.resolve.fallback,
            process: require.resolve('process/browser'),
            zlib: require.resolve('browserify-zlib'),
            stream: require.resolve('stream-browserify'),
            util: require.resolve('util'),
            buffer: require.resolve('buffer'),
            assert: require.resolve('assert'),
            // Node-only modules pulled in by the LayerZero Solana SDK (unused in the browser)
            http: false,
            https: false,
            os: false,
            fs: false,
            url: false,
            net: false,
            tls: false,
            child_process: false,
            path: require.resolve('path-browserify'),
            crypto: require.resolve('crypto-browserify'),
          };

          webpackConfig.plugins = [
            ...webpackConfig.plugins,
            new webpack.ProvidePlugin({
              Buffer: ['buffer', 'Buffer'],
              process: 'process/browser',
            }),
          ];

          webpackConfig.resolve.alias = {
            ...webpackConfig.resolve.alias,
            '@layerzerolabs/lz-utilities$': require('path').resolve(__dirname, 'src/shims/lz-utilities.js'),
          };

          // CRA 5's catch-all file loader treats `.cjs` as a static asset, so `require()` of
          // a .cjs module (umi, mpl-toolbox…) returns a URL string → "Class extends undefined".
          const oneOf = webpackConfig.module.rules.find((r) => Array.isArray(r.oneOf));
          if (oneOf) oneOf.oneOf.unshift({ test: /\.cjs$/, type: 'javascript/auto' });

          // Optional: If you're dealing with .mjs files or modules with "type": "module"
          // in their package.json, you might need this rule for fully specified imports.
          webpackConfig.module.rules.push({
            test: /\.m?js$/,
            resolve: {
              fullySpecified: false,
            },
          });

          // Ignore source map warnings from node_modules
          webpackConfig.ignoreWarnings = [
            function ignoreSourcemapsloaderWarnings(warning) {
              return (
                warning.module &&
                warning.module.resource.includes('node_modules') &&
                warning.details &&
                warning.details.includes('source-map-loader')
              );
            },
          ];

          return webpackConfig;
        },
      },
    };